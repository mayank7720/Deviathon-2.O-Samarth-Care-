import { serverRuntime,normalizeNodeRequest } from "@/lib/server-runtime.mjs";
import { handleApi } from "../../../lib/api.mjs";
import { showcaseEnvironment } from "../../../lib/model-runtime.mjs";

export const dynamic = "force-dynamic";
function route(request: Request) {
  const { env, db, local } = serverRuntime();
  return handleApi(normalizeNodeRequest(request), db, {
    local,
    env:showcaseEnvironment(env),
  });
}
export { route as GET, route as POST, route as PUT, route as PATCH, route as DELETE };
