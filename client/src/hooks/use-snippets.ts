import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type SnippetInput } from "@shared/routes";

// GET /api/snippets
export function useSnippets() {
  return useQuery({
    queryKey: [api.snippets.list.path],
    queryFn: async () => {
      const res = await fetch(api.snippets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch snippets");
      return api.snippets.list.responses[200].parse(await res.json());
    },
  });
}

// GET /api/snippets/:id
export function useSnippet(id: number | null) {
  return useQuery({
    queryKey: [api.snippets.get.path, id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const url = buildUrl(api.snippets.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch snippet");
      return api.snippets.get.responses[200].parse(await res.json());
    },
  });
}

// POST /api/snippets
export function useCreateSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: SnippetInput) => {
      const res = await fetch(api.snippets.create.path, {
        method: api.snippets.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.snippets.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create snippet");
      }
      return api.snippets.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.snippets.list.path] });
    },
  });
}

// DELETE /api/snippets/:id
export function useDeleteSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.snippets.delete.path, { id });
      const res = await fetch(url, { 
        method: api.snippets.delete.method,
        credentials: "include" 
      });
      
      if (res.status === 404) throw new Error("Snippet not found");
      if (!res.ok) throw new Error("Failed to delete snippet");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.snippets.list.path] });
    },
  });
}
