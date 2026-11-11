/* Cricket.lk email worker: sends the database's emails (claim and merge
   requests, supabase/021 + 022) through Gmail SMTP. See README.md. */
import { connect } from "cloudflare:sockets";
import { handle } from "./handler.js";

export default {
  fetch(request, env){
    return handle(request, env, { connect });
  }
};
