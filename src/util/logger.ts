import * as vscode from "vscode";
import * as winston from "winston";
import { format } from "winston";
import * as path from "path";
import * as fs from "fs";
import { Writable } from "stream"; // 导入 stream 模块

// support outputChannel, the name is Synapse
let _outputChannel: vscode.OutputChannel | undefined;
const outputChannelStream = new Writable({
    write(chunk, encoding, callback) {
        if (!_outputChannel) {
            _outputChannel = vscode.window.createOutputChannel("Synapse");
        }
        const log_message = chunk.toString().trim();
        if (log_message.includes("[info]") || log_message.includes("[error]")) {
            _outputChannel.appendLine(log_message);
        }
        callback();
    },
});

const outputChannelTransport = new winston.transports.Stream({
    stream: outputChannelStream,
    handleExceptions: true, // 处理异常
});

// 自定义格式：获取日志文件名，函数，行号
const addCallerFileName = format((info) => {
    // 创建一个 Error 对象以获取调用栈
    const stack = new Error().stack;
    if (stack) {
        // 解析调用栈信息
        const stackLines = stack.split("\n");
        // 找到触发日志的调用行（通常是第 3 行,这里是第11行）
        const callerLine = stackLines[11];
        // const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
        const regexWithFunc = /at (.+) \((.+):(\d+):(\d+)\)/;
        const regexNoFunc = /at (.+):(\d+):(\d+)/;
        let match;
        if ((match = callerLine.match(regexWithFunc))) {
            const [, functionName, filePath, lineNumber] = match;
            info.functionName = functionName;
            info.callerFileName = path.basename(filePath);
            info.lineNumber = lineNumber;
        } else if ((match = callerLine.match(regexNoFunc))) {
            const [, filePath, lineNumber] = match;
            info.functionName = "anonymous";
            info.callerFileName = path.basename(filePath);
            info.lineNumber = lineNumber;
        }
    }
    return info;
});

// 日志目录存在
const logDir = path.resolve(__dirname, ".."); // 当前模块目录的上两级
const logFilePath = path.join(logDir, "synapse.log"); // 日志文件路径
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true }); // 创建文件夹
}

// 配置 winston 日志记录器
const logger = winston.createLogger({
    level: "debug", //设置日志默认级别
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        addCallerFileName(),
        winston.format.printf(
            ({
                timestamp,
                level,
                message,
                callerFileName,
                functionName,
                lineNumber,
            }) => {
                return `${timestamp} [${level}] [${callerFileName}:${functionName}:${lineNumber}]: ${message}`;
            },
        ),
    ),
    transports: [
        // new winston.transports.Console(), // disabled: stdout is captured by Remote-SSH output channel, causing noise
        // 10 MB, 保留3个备份文件
        new winston.transports.File({
            filename: logFilePath,
            maxsize: 10485760,
            maxFiles: 3,
            tailable: true,
        }),
        // support outputchannel,
        outputChannelTransport,
    ],
});

export const Log = {
    trace: (message: string) => logger.log("silly", message),
    debug: (message: string) => logger.debug(message),
    info: (message: string) => logger.info(message),
    warn: (message: string) => logger.warn(message),
    error: (message: string) => logger.error(message),
    fatal: (message: string) => logger.log("fatal", message),
};

export async function showOutputChannel() {
    if (_outputChannel) {
        _outputChannel.show();
    } else {
        _outputChannel = vscode.window.createOutputChannel("Synapse");
        _outputChannel.show();
    }
}
