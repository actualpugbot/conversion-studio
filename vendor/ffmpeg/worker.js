/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { CORE_URL, FFMessageType } from "./const.js";
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED, ERROR_IMPORT_FAILURE } from "./errors.js";

let ffmpeg;

const load = async ({ coreURL: maybeCoreURL, wasmURL: maybeWasmURL, workerURL: maybeWorkerURL }) => {
    const first = !ffmpeg;
    let coreURL = maybeCoreURL;

    try {
        if (!coreURL) {
            coreURL = CORE_URL;
        }
        importScripts(coreURL);
    } catch {
        if (!coreURL) {
            coreURL = CORE_URL.replace("/umd/", "/esm/");
        }
        self.createFFmpegCore = (await import(
            /* webpackIgnore: true */ /* @vite-ignore */ coreURL
        )).default;
        if (!self.createFFmpegCore) {
            throw ERROR_IMPORT_FAILURE;
        }
    }

    const wasmURL = maybeWasmURL ? maybeWasmURL : coreURL.replace(/.js$/g, ".wasm");
    const workerURL = maybeWorkerURL ? maybeWorkerURL : coreURL.replace(/.js$/g, ".worker.js");

    ffmpeg = await self.createFFmpegCore({
        mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
    });
    ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
    ffmpeg.setProgress((data) => self.postMessage({
        type: FFMessageType.PROGRESS,
        data,
    }));
    return first;
};

const exec = ({ args, timeout = -1 }) => {
    ffmpeg.setTimeout(timeout);
    ffmpeg.exec(...args);
    const returnCode = ffmpeg.ret;
    ffmpeg.reset();
    return returnCode;
};

const writeFile = ({ path, data }) => {
    ffmpeg.FS.writeFile(path, data);
    return true;
};

const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });

const deleteFile = ({ path }) => {
    ffmpeg.FS.unlink(path);
    return true;
};

const rename = ({ oldPath, newPath }) => {
    ffmpeg.FS.rename(oldPath, newPath);
    return true;
};

const createDir = ({ path }) => {
    ffmpeg.FS.mkdir(path);
    return true;
};

const listDir = ({ path }) => {
    const names = ffmpeg.FS.readdir(path);
    const nodes = [];

    for (const name of names) {
        const stat = ffmpeg.FS.stat(`${path}/${name}`);
        nodes.push({ name, isDir: ffmpeg.FS.isDir(stat.mode) });
    }

    return nodes;
};

const deleteDir = ({ path }) => {
    ffmpeg.FS.rmdir(path);
    return true;
};

const mount = ({ fsType, options, mountPoint }) => {
    const fs = ffmpeg.FS.filesystems[fsType];

    if (!fs) {
        return false;
    }

    ffmpeg.FS.mount(fs, options, mountPoint);
    return true;
};

const unmount = ({ mountPoint }) => {
    ffmpeg.FS.unmount(mountPoint);
    return true;
};

self.onmessage = async ({ data: { id, type, data: payload } }) => {
    const trans = [];
    let data;

    try {
        if (type !== FFMessageType.LOAD && !ffmpeg) {
            throw ERROR_NOT_LOADED;
        }

        switch (type) {
            case FFMessageType.LOAD:
                data = await load(payload);
                break;
            case FFMessageType.EXEC:
                data = exec(payload);
                break;
            case FFMessageType.WRITE_FILE:
                data = writeFile(payload);
                break;
            case FFMessageType.READ_FILE:
                data = readFile(payload);
                break;
            case FFMessageType.DELETE_FILE:
                data = deleteFile(payload);
                break;
            case FFMessageType.RENAME:
                data = rename(payload);
                break;
            case FFMessageType.CREATE_DIR:
                data = createDir(payload);
                break;
            case FFMessageType.LIST_DIR:
                data = listDir(payload);
                break;
            case FFMessageType.DELETE_DIR:
                data = deleteDir(payload);
                break;
            case FFMessageType.MOUNT:
                data = mount(payload);
                break;
            case FFMessageType.UNMOUNT:
                data = unmount(payload);
                break;
            default:
                throw ERROR_UNKNOWN_MESSAGE_TYPE;
        }
    } catch (error) {
        self.postMessage({
            id,
            type: FFMessageType.ERROR,
            data: error.toString(),
        });
        return;
    }

    if (data instanceof Uint8Array) {
        trans.push(data.buffer);
    }

    self.postMessage({ id, type, data }, trans);
};
