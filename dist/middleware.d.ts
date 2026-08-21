/**
 * 中间件与控制流（28–34）：洋葱模型 compose、短路、finally 钩子。
 */
import { Context, CtxMiddleware } from './context';
export type Stack = ReturnType<typeof compose>;
/** Koa 式洋葱模型组合：前后皆可切（await next() 之后代码作为后半程执行） */
export declare function compose(middlewares: CtxMiddleware[]): (context: Context, done?: () => Promise<unknown>) => Promise<unknown>;
/** 中间件短路：内部调用 ctx.json()/ctx.send() 后，可标记 handled 并停止 next */
export declare function stop(): never;
export type { Context, CtxMiddleware };
