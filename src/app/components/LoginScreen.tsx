import React from "react";
import { Bot } from "lucide-react";

export function LoginScreen({
  onLogin,
  loading,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
  loading: boolean;
}) {
  const [username, setUsername] = React.useState("admin");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await onLogin(username, password);
    } catch (err: any) {
      setError(err?.message || "Sign-in failed");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl">
        <div className="mb-8">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
            <Bot className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold text-zinc-50">{"CryptoQuant AI Console"}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {"Sign in to open the console."}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">{"Username"}</span>
            <input
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-50 outline-none transition focus:border-indigo-500"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">{"Password"}</span>
            <input
              type="password"
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-50 outline-none transition focus:border-indigo-500"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-indigo-500 px-4 py-3 font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-900"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
