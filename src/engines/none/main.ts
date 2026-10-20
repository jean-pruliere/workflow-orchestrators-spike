import { createServer } from "node:http";

import { runChain, type ChainIn, type StepIn, type StepOut } from "../../chain.ts";
import { postJson, readBody } from "../../http.ts";
import { step } from "../../step.ts";

const role = process.env.ROLE;

const server = createServer({ requestTimeout: 0, keepAliveTimeout: 30_000 }, async (req, res) => {
  try {
    const body = JSON.parse(await readBody(req));
    if (role === "a" && req.url !== "/chain") throw new Error(`the no-engine baseline only runs the chain, not ${req.url}`);
    const out =
      role === "a"
        ? await runChain(body as ChainIn, (target, input) => postJson<StepOut>(`http://${target}:8080/advance`, input))
        : await step(body as StepIn);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
  }
});
server.listen(8080, () => console.log(`none/${role} listening on 8080`));
