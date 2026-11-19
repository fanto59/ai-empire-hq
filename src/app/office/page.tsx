import type { Metadata } from "next";
import { ExecutiveFloor } from "@/frontend/executive-floor/ExecutiveFloor";

export const metadata: Metadata = {
  title: "Executive Floor · AI Empire HQ",
};

export default function ExecutiveFloorPage() {
  return <ExecutiveFloor />;
}
