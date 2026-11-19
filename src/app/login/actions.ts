"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";

export interface SignInState {
  error: string | null;
}

export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const db = await getDatabase();
  if (!db) return { error: "The database is not set up." };
  const token = String(form.get("token") ?? "");
  try {
    await signIn(db, token);
  } catch (e) {
    return { error: e instanceof ServiceError ? e.message : "Sign-in failed." };
  }
  redirect("/tasks");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/tasks");
}
