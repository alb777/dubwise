// @ts-check
// Runs the in-browser model off the main thread, so the riddim keeps time while the model thinks.
import { WEBLLM_URL } from "./ai.js";

// The page starts talking as soon as the worker exists, before WebLLM has loaded. Listening right away and handing
// each message on once the library is here keeps that first message, which asks for the model, from being lost.
const handler = import(WEBLLM_URL).then(({ WebWorkerMLCEngineHandler }) => new WebWorkerMLCEngineHandler());
self.onmessage = (event) => {
    void handler.then((engine) => engine.onmessage(event));
};
