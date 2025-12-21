"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = __importDefault(require("./app"));
async function start() {
    try {
        const port = Number(process.env.PORT) || 4002;
        await app_1.default.listen({ port, host: "0.0.0.0" });
        console.log(`Server running at http://localhost:${port}`);
    }
    catch (err) {
        app_1.default.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map