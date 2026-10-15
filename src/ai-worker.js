// @ts-check
// Runs the in-browser model off the main thread, so the riddim keeps time while the model thinks.
// It imports only webllm.js, which imports nothing: the page talks as soon as the worker exists, and a message that
// arrives while the worker's imports still load is lost.
import { WEBLLM_URL } from "./webllm.js";

// Listening right away and handing each message on once WebLLM has loaded keeps the first message, which asks for the
// model, from being lost.
const handler = import(WEBLLM_URL).then(({ WebWorkerMLCEngineHandler }) => new WebWorkerMLCEngineHandler());
self.onmessage = (event) => {
    void handler.then((engine) => engine.onmessage(event));
};
