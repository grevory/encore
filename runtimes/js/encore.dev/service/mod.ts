import { APICallMeta } from "../req_meta";

/**
 * Defines an Encore backend service.
 *
 * Use this class to define a new backend service with the given name.
 * The scope of the service is its containing directory, and all subdirectories.
 *
 * It must be called from files named `encore.service.ts`, to enable Encore to
 * efficiently identify possible service definitions.
 */
export class Service {
  public readonly name: string;
  public readonly cfg: ServiceConfig;
  public readonly middlewares: Middleware[];

  constructor(name: string, cfg?: ServiceConfig, md?: Middleware[]) {
    this.name = name;
    this.cfg = cfg ?? {};
    this.middlewares = md || [];
  }
}

export interface ServiceConfig {}

export type Next = (req: APICallMeta) => Promise<Response>;
export type Middleware = (req: APICallMeta, next: Next) => Promise<Response>;
