import { postJson } from "../../http.ts";

const admin = process.env.RESTATE_ADMIN ?? "http://restate:9070";
const targets = (process.env.TARGETS ?? "a b c").split(" ");

for (const host of targets) {
  for (let attempt = 1; ; attempt++) {
    try {
      await postJson(`${admin}/deployments`, { uri: `http://${host}:9080`, force: true });
      console.log(`registered http://${host}:9080`);
      break;
    } catch (error) {
      if (attempt >= 60) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
