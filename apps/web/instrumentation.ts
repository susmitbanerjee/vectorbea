export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRegressionScheduler } = await import("./lib/server/regression-scheduler");
    startRegressionScheduler();
  }
}
