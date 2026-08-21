/**
 * 中间件与控制流（28–34）：洋葱模型 compose、短路、finally 钩子。
 */

import { Context, CtxMiddleware } from './context';

export type Stack = ReturnType<typeof compose>;

/** Koa 式洋葱模型组合：前后皆可切（await next() 之后代码作为后半程执行） */
export function compose(middlewares: CtxMiddleware[]) {
  return function (context: Context, done?: () => Promise<unknown>): Promise<unknown> {
    let index = -1;
    function dispatch(i: number): Promise<unknown> {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'));
      index = i;
      let fn = middlewares[i];
      if (i === middlewares.length) fn = done ?? (async () => undefined);
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(context, function next(): Promise<unknown> {
          return dispatch(i + 1);
        }));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

/** 中间件短路：内部调用 ctx.json()/ctx.send() 后，可标记 handled 并停止 next */
export function stop(): never {
  // 实际不会执行；调用方靠 ctx.handled 判断
  throw new Error('stop() is a marker; use ctx.markHandled()');
}

export type { Context, CtxMiddleware };