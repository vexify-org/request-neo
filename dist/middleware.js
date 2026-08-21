"use strict";
/**
 * 中间件与控制流（28–34）：洋葱模型 compose、短路、finally 钩子。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compose = compose;
exports.stop = stop;
/** Koa 式洋葱模型组合：前后皆可切（await next() 之后代码作为后半程执行） */
function compose(middlewares) {
    return function (context, done) {
        let index = -1;
        function dispatch(i) {
            if (i <= index)
                return Promise.reject(new Error('next() called multiple times'));
            index = i;
            let fn = middlewares[i];
            if (i === middlewares.length)
                fn = done ?? (async () => undefined);
            if (!fn)
                return Promise.resolve();
            try {
                return Promise.resolve(fn(context, function next() {
                    return dispatch(i + 1);
                }));
            }
            catch (err) {
                return Promise.reject(err);
            }
        }
        return dispatch(0);
    };
}
/** 中间件短路：内部调用 ctx.json()/ctx.send() 后，可标记 handled 并停止 next */
function stop() {
    // 实际不会执行；调用方靠 ctx.handled 判断
    throw new Error('stop() is a marker; use ctx.markHandled()');
}
