import { APIError } from "../../api/error";
import { Gateway } from "../../api/gateway";
import { RawRequest, RawResponse } from "../api/node_http";
import { setCurrentRequest } from "../reqtrack/mod";
import * as runtime from "../runtime/mod";

export type Handler = {
  apiRoute: runtime.ApiRoute;
  middlewares: Middleware[];
};

export function registerHandlers(handlers: Handler[]) {
  runtime.RT.registerHandlers(handlers.map((h) => transformHandler(h)));
}

export function registerTestHandler(handler: Handler) {
  runtime.RT.registerTestHandler(transformHandler(handler));
}

export function registerGateways(gateways: Gateway[]) {
  // This function exists to ensure gateways are imported and executed.
  // It intentionally doesn't need to do anything.
}

export async function run() {
  return runtime.RT.runForever();
}

class IterableStream {
  private stream: runtime.Stream;

  constructor(stream: runtime.Stream) {
    this.stream = stream;
  }

  recv(): Promise<Record<string, any>> {
    return this.stream.recv();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      try {
        yield await this.stream.recv();
      } catch (e) {
        break;
      }
    }
  }
}

class IterableSocket {
  private socket: runtime.Socket;

  constructor(socket: runtime.Socket) {
    this.socket = socket;
  }

  send(msg: Record<string, any>): void {
    return this.socket.send(msg);
  }
  recv(): Promise<Record<string, any>> {
    return this.socket.recv();
  }

  close(): void {
    this.socket.close();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      try {
        yield await this.socket.recv();
      } catch (e) {
        break;
      }
    }
  }
}

export type Next = (req: runtime.Request) => Promise<Response>;
export type Middleware = (
  req: runtime.Request,
  next: Next
) => Promise<Response>;

function invoke(req: runtime.Request, mws: Middleware[]): Promise<Response> {
  const middleware = mws.shift();

  if (!middleware) {
    throw APIError.internal(
      "no middlewares to call, was the handler not added to the chain?"
    );
  }
  return middleware(req, async () => {
    return await invoke(req, mws);
  });
}

function transformHandler(h: Handler): runtime.ApiRoute {
  if (h.apiRoute.streamingResponse || h.apiRoute.streamingRequest) {
    return {
      ...h.apiRoute,
      // req is the upgrade request.
      // stream is either a bidirectional stream, in stream or out stream.
      handler: (req: runtime.Request, stream: unknown) => {
        setCurrentRequest(req);

        // make readable streams async iterators
        if (stream instanceof runtime.Stream) {
          stream = new IterableStream(stream);
        }
        if (stream instanceof runtime.Socket) {
          stream = new IterableSocket(stream);
        }

        // handshake payload
        const payload = req.payload();
        return payload !== null
          ? h.apiRoute.handler(payload, stream)
          : h.apiRoute.handler(stream);
      }
    };
  }

  if (h.apiRoute.raw) {
    return {
      ...h.apiRoute,
      handler: (
        req: runtime.Request,
        resp: runtime.ResponseWriter,
        body: runtime.BodyReader
      ) => {
        setCurrentRequest(req);
        const rawReq = new RawRequest(req, body);
        const rawResp = new RawResponse(rawReq, resp);
        return h.apiRoute.handler(rawReq, rawResp);
      }
    };
  }

  return {
    ...h.apiRoute,
    handler: (req: runtime.Request) => {
      h.middlewares.push((req, _next) => {
        setCurrentRequest(req);
        const payload = req.payload();
        return payload !== null
          ? h.apiRoute.handler(payload)
          : h.apiRoute.handler();
      });
      return invoke(req, h.middlewares);
    }
  };
}
