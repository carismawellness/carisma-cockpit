import { redirect } from "next/navigation";

export default function EtlRunnerRedirect() {
  redirect("/settings/data-sources");
}
