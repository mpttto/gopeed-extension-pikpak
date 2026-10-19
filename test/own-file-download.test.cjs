const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function makeRuntime() {
  const calls = [];
  const replies = [
    { body: { captcha_token: "fresh-captcha" } },
    { body: { id: "own-file-id", web_content_link: "https://dl.example/file.bin" } },
  ];
  const context = vm.createContext({
    fetch: async (url, options) => {
      calls.push({ url: String(url), options: options || {} });
      const reply = replies.shift();
      assert.ok(reply, "unexpected request: " + url);
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify(reply.body),
      };
    },
    gopeed: {
      settings: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      storage: { get() { return null; }, set() {} },
      events: { onResolve() {} },
    },
  });
  vm.runInContext(source, context);
  return { context, calls };
}

test("own-file download link uses a fresh action-scoped CAPTCHA and clean file URL request", async () => {
  const runtime = makeRuntime();
  const client = new runtime.context.PikPakClient({});
  client.accessToken = "test-access-token";
  client.userId = "test-user-id";
  client.captchaToken = "stale-captcha";
  client.captchaAction = "POST:/drive/v1/share/restore";

  const file = await client.getOwnFile("own-file-id");

  assert.equal(file.web_content_link, "https://dl.example/file.bin");
  assert.equal(runtime.calls.length, 2);

  const captchaRequest = runtime.calls[0];
  assert.match(captchaRequest.url, /\/v1\/shield\/captcha\/init/);
  const captchaBody = JSON.parse(captchaRequest.options.body);
  assert.equal(captchaBody.action, "GET:/drive/v1/files/own-file-id");

  const fileRequest = runtime.calls[1];
  assert.equal(fileRequest.url, "https://api-drive.mypikpak.net/drive/v1/files/own-file-id");
  assert.equal(fileRequest.options.headers["X-Captcha-Token"], "fresh-captcha");
  assert.equal(fileRequest.options.headers.Authorization, "Bearer test-access-token");
  assert.equal(fileRequest.options.url, undefined);
});
