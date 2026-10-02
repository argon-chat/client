/**
 * What a call does when the server turns its credential away.
 *
 * On the web the access cookie is cut to minutes, so a tab left open for an afternoon comes back
 * with every call refused `NO_AUTH` until the cookie is renewed. The renewal itself always worked;
 * the call that discovered the need for it did not — it failed, and the DM list stayed empty. The
 * call has to wait for the renewal and go again.
 *
 * The other half is the burst. A refused call that went out before the last renewal landed is a
 * straggler, not news: starting a refresh of its own counted towards the renewal-loop guard, and
 * three of them inside a minute signed a perfectly good session out.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { IonRequestException, type IonCallContext } from "@argon-chat/ion.webcore";

const stubs = vi.hoisted(() => ({
  handleSessionRejected: vi.fn(async () => "renewed" as "renewed" | "signed_out" | "unknown"),
}));

vi.mock("@/lib/net/sessionRecovery", () => ({ handleSessionRejected: stubs.handleSessionRejected }));

const refused = (code = "NO_AUTH") => new IonRequestException({ code, message: "Unauthorized" }, 400);

/** A stand-in for the auth store: a token, and the generation counter `setAuthToken` bumps. */
function fakeAuth(token: string | null = "token-1") {
  let generation = 0;
  const auth = {
    token,
    credentialGeneration: () => generation,
    renew(next: string) {
      auth.token = next;
      generation++;
    },
  };
  return auth;
}

async function interceptor(auth: ReturnType<typeof fakeAuth>, { web }: { web: boolean }) {
  vi.resetModules();
  vi.doMock("@/lib/platform", () => ({ isWeb: web, isNative: !web }));
  const { AuthInterceptor } = await import("@/store/system/apiStore");
  return new AuthInterceptor({ value: auth } as any);
}

const call = (methodName = "QueryDirectMessages"): IonCallContext =>
  ({ interfaceName: "IUserChatInteractions", methodName, requestHeaders: {} }) as unknown as IonCallContext;

/** Let the fire-and-forget recovery's dynamic import settle before asserting on it. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  stubs.handleSessionRejected.mockResolvedValue("renewed");
});

describe("a call refused for its credential", () => {
  test("waits for the renewal and goes again", async () => {
    const auth = fakeAuth();
    const next = vi.fn().mockRejectedValueOnce(refused()).mockResolvedValueOnce(undefined);

    await (await interceptor(auth, { web: true })).invokeAsync(call(), next);

    expect(stubs.handleSessionRejected).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("a straggler from before the last renewal is sent again without starting another", async () => {
    const auth = fakeAuth();
    // Refused for the old credential, and by the time the answer arrives a refresh has landed.
    const next = vi
      .fn()
      .mockImplementationOnce(async () => {
        auth.renew("token-2");
        throw refused();
      })
      .mockResolvedValueOnce(undefined);

    await (await interceptor(auth, { web: true })).invokeAsync(call(), next);

    expect(stubs.handleSessionRejected).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("fails as before when the renewal could not tell", async () => {
    stubs.handleSessionRejected.mockResolvedValue("unknown");
    const next = vi.fn().mockRejectedValue(refused());

    await expect((await interceptor(fakeAuth(), { web: true })).invokeAsync(call(), next)).rejects.toThrow(
      IonRequestException,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("goes again only once, and reports the second refusal to recovery", async () => {
    const auth = fakeAuth();
    stubs.handleSessionRejected.mockImplementation(async () => {
      auth.renew("token-2");
      return "renewed";
    });
    const next = vi.fn().mockRejectedValue(refused());

    await expect((await interceptor(auth, { web: true })).invokeAsync(call(), next)).rejects.toThrow();
    await settle();

    expect(next).toHaveBeenCalledTimes(2);
    // Refused on a brand-new credential: the case the renewal-loop guard has to see.
    expect(stubs.handleSessionRejected).toHaveBeenCalledTimes(2);
  });

  test("a verdict that does not promise the call ran nothing is not retried", async () => {
    const next = vi.fn().mockRejectedValue(refused("DEVICE_BANNED"));

    await expect((await interceptor(fakeAuth(), { web: true })).invokeAsync(call(), next)).rejects.toThrow();
    await settle();

    expect(next).toHaveBeenCalledTimes(1);
    expect(stubs.handleSessionRejected).toHaveBeenCalledTimes(1);
  });

  test("the refresh call itself is never recovered", async () => {
    const next = vi.fn().mockRejectedValue(refused());

    await expect(
      (await interceptor(fakeAuth(), { web: true })).invokeAsync(call("GetMyAuthorization"), next),
    ).rejects.toThrow();
    await settle();

    expect(next).toHaveBeenCalledTimes(1);
    expect(stubs.handleSessionRejected).not.toHaveBeenCalled();
  });

  test("on the desktop the retry carries the token the refresh minted", async () => {
    const auth = fakeAuth("token-1");
    stubs.handleSessionRejected.mockImplementation(async () => {
      auth.renew("token-2");
      return "renewed";
    });
    const sent: string[] = [];
    const next = vi.fn(async (ctx: IonCallContext) => {
      sent.push((ctx.requestHeaders as Record<string, string>).Authorization);
      if (sent.length === 1) throw refused();
    });

    await (await interceptor(auth, { web: false })).invokeAsync(call(), next);

    expect(sent).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  test("on the web no bearer goes out, on either attempt", async () => {
    const sent: unknown[] = [];
    const next = vi.fn(async (ctx: IonCallContext) => {
      sent.push((ctx.requestHeaders as Record<string, string>).Authorization);
      if (sent.length === 1) throw refused();
    });

    await (await interceptor(fakeAuth(), { web: true })).invokeAsync(call(), next);

    expect(sent).toEqual([undefined, undefined]);
  });
});
