/**
 * 解析 Content-Disposition 头部（multipart part headers 用）。
 */
export interface ContentDisposition {
    name?: string;
    filename?: string;
    [key: string]: string | undefined;
}
export declare function parseContentDisposition(header: string): ContentDisposition;
