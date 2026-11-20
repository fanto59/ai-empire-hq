import type { Metadata } from "next";
import { SignInForm } from "@/frontend/tasks/SignInForm";
import { signInAction } from "./actions";

export const metadata: Metadata = { title: "Sign in · AI Empire HQ" };

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold text-white">Sign in</h1>
      <p className="mt-2 text-sm text-slate-400">
        Paste an API token to create tasks from the dashboard. Create one on the server with{" "}
        <code className="text-slate-300">npm run db:token -- --name &quot;my browser&quot;</code>. It is kept in a secure,
        HTTP-only cookie for 8 hours.
      </p>
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <SignInForm action={signInAction} />
      </div>
    </main>
  );
}
