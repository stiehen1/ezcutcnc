import { useMutation } from "@tanstack/react-query";

export type MentorPayload = Record<string, unknown>;

export type MentorResponse = any; // we’ll strongly type later

async function postMentor(payload: MentorPayload): Promise<MentorResponse> {
  const res = await fetch("/api/mentor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      json?.error || json?.message || `Request failed (${res.status})`
    );
  }

  return json?.result ?? json;
}

export function useMentor() {
  return useMutation({
    mutationFn: postMentor,
  });
}