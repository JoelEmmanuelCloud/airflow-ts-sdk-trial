import { execFileSync } from "node:child_process";

const variables = {
  route_health_as_of: "2026-11-19T23:30:00-05:00",
  route_health_delay_threshold_minutes: "5",
  route_health_inject_failure: "true",
};

for (const [key, value] of Object.entries(variables)) {
  execFileSync("docker", ["compose", "exec", "-T", "airflow", "airflow", "variables", "set", key, value], {
    stdio: "inherit",
  });
}
