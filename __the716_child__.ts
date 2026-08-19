
import { scheduleForceExitIfNonDaemon, FORCE_EXIT_GRACE_MS } from "./src/pubsub/safety-net.ts";

const isNonDaemon = process.argv[2] === "true";
const reason = process.argv[3] ?? "quit";

console.log("child-starting isNonDaemon=" + isNonDaemon + " reason=" + reason);

const timer = scheduleForceExitIfNonDaemon(isNonDaemon, reason);
console.log("safety-net-armed=" + (timer !== null));

// Simulate a stray ref'd handle that strands the process (the bug THE-716 fixes).
setInterval(() => {}, 1000);

process.on("exit", (code) => {
  console.log("child-exit code=" + code);
});
