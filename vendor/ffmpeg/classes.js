import { FFMessageType } from "./const.js";
import { getMessageID } from "./utils.js";
import { ERROR_TERMINATED, ERROR_NOT_LOADED } from "./errors.js";

export class FFmpeg {
    #worker = null;
    #resolves = {};
    #rejects = {};
    #logEventCallbacks = [];
    #progressEventCallbacks = [];
    loaded = false;
    #registerHandlers = () => {
        if (this.#worker) {
            this.#worker.onmessage = ({ data: { id, type, data }, }) => {
                switch (type) {
                    case FFMessageType.LOAD:
                        this.loaded = true;
                        this.#resolves[id](data);
                        break;
                    case FFMessageType.MOUNT:
                    case FFMessageType.UNMOUNT:
                    case FFMessageType.EXEC:
                    case FFMessageType.WRITE_FILE:
                    case FFMessageType.READ_FILE:
                    case FFMessageType.DELETE_FILE:
                    case FFMessageType.RENAME:
                    case FFMessageType.CREATE_DIR:
                    case FFMessageType.LIST_DIR:
                    case FFMessageType.DELETE_DIR:
                        this.#resolves[id](data);
                        break;
                    case FFMessageType.LOG:
                        this.#logEventCallbacks.forEach((callback) => callback(data));
                        break;
                    case FFMessageType.PROGRESS:
                        this.#progressEventCallbacks.forEach((callback) => callback(data));
                        break;
                    case FFMessageType.ERROR:
                        this.#rejects[id](data);
                        break;
                }
                delete this.#resolves[id];
                delete this.#rejects[id];
            };
        }
    };
    #send = ({ type, data }, trans = [], signal) => {
        if (!this.#worker) {
            return Promise.reject(ERROR_NOT_LOADED);
        }
        return new Promise((resolve, reject) => {
            const id = getMessageID();
            this.#worker && this.#worker.postMessage({ id, type, data }, trans);
            this.#resolves[id] = resolve;
            this.#rejects[id] = reject;
            signal?.addEventListener("abort", () => {
                reject(new DOMException(`Message # ${id} was aborted`, "AbortError"));
            }, { once: true });
        });
    };
    on(event, callback) {
        if (event === "log") {
            this.#logEventCallbacks.push(callback);
        } else if (event === "progress") {
            this.#progressEventCallbacks.push(callback);
        }
    }
    off(event, callback) {
        if (event === "log") {
            this.#logEventCallbacks = this.#logEventCallbacks.filter((item) => item !== callback);
        } else if (event === "progress") {
            this.#progressEventCallbacks = this.#progressEventCallbacks.filter((item) => item !== callback);
        }
    }
    load = ({ classWorkerURL, ...config } = {}, { signal } = {}) => {
        if (!this.#worker) {
            this.#worker = classWorkerURL
                ? new Worker(new URL(classWorkerURL, import.meta.url), {
                    type: "module",
                })
                : new Worker(new URL("./worker.js", import.meta.url), {
                    type: "module",
                });
            this.#registerHandlers();
        }
        return this.#send({
            type: FFMessageType.LOAD,
            data: config,
        }, undefined, signal);
    };
    exec = (args, timeout = -1, { signal } = {}) => this.#send({
        type: FFMessageType.EXEC,
        data: { args, timeout },
    }, undefined, signal);
    terminate = () => {
        const ids = Object.keys(this.#rejects);
        for (const id of ids) {
            this.#rejects[id](ERROR_TERMINATED);
            delete this.#rejects[id];
            delete this.#resolves[id];
        }
        if (this.#worker) {
            this.#worker.terminate();
            this.#worker = null;
            this.loaded = false;
        }
    };
    writeFile = (path, data, { signal } = {}) => {
        const trans = [];
        if (data instanceof Uint8Array) {
            trans.push(data.buffer);
        }
        return this.#send({
            type: FFMessageType.WRITE_FILE,
            data: { path, data },
        }, trans, signal);
    };
    mount = (fsType, options, mountPoint) => {
        const trans = [];
        return this.#send({
            type: FFMessageType.MOUNT,
            data: { fsType, options, mountPoint },
        }, trans);
    };
    unmount = (mountPoint) => {
        const trans = [];
        return this.#send({
            type: FFMessageType.UNMOUNT,
            data: { mountPoint },
        }, trans);
    };
    readFile = (path, encoding = "binary", { signal } = {}) => this.#send({
        type: FFMessageType.READ_FILE,
        data: { path, encoding },
    }, undefined, signal);
    deleteFile = (path, { signal } = {}) => this.#send({
        type: FFMessageType.DELETE_FILE,
        data: { path },
    }, undefined, signal);
    rename = (oldPath, newPath, { signal } = {}) => this.#send({
        type: FFMessageType.RENAME,
        data: { oldPath, newPath },
    }, undefined, signal);
    createDir = (path, { signal } = {}) => this.#send({
        type: FFMessageType.CREATE_DIR,
        data: { path },
    }, undefined, signal);
    listDir = (path, { signal } = {}) => this.#send({
        type: FFMessageType.LIST_DIR,
        data: { path },
    }, undefined, signal);
    deleteDir = (path, { signal } = {}) => this.#send({
        type: FFMessageType.DELETE_DIR,
        data: { path },
    }, undefined, signal);
}
