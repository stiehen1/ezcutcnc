import { useSnippets, useDeleteSnippet } from "@/hooks/use-snippets";
import { format } from "date-fns";
import { Trash2, Code2, Terminal, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SnippetListProps {
  currentId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}

export function SnippetList({ currentId, onSelect, onNew }: SnippetListProps) {
  const { data: snippets, isLoading } = useSnippets();
  const { mutate: deleteSnippet } = useDeleteSnippet();

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-full bg-accent/30" />
        <Skeleton className="h-20 w-full bg-accent/20" />
        <Skeleton className="h-20 w-full bg-accent/20" />
        <Skeleton className="h-20 w-full bg-accent/20" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-4 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg tracking-tight flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            Snippets
          </h2>
          <span className="text-xs text-muted-foreground font-mono bg-accent px-2 py-0.5 rounded-full">
            {snippets?.length || 0}
          </span>
        </div>
        <Button 
          onClick={onNew} 
          className="w-full bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 border"
          variant="outline"
        >
          <Code2 className="w-4 h-4 mr-2" />
          New Snippet
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {snippets?.length === 0 && (
            <div className="text-center py-10 px-4">
              <Code2 className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No snippets yet.</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Create one to get started coding!</p>
            </div>
          )}

          {snippets?.map((snippet) => (
            <div
              key={snippet.id}
              onClick={() => onSelect(snippet.id)}
              className={cn(
                "group relative p-3 rounded-lg border border-transparent transition-all duration-200 cursor-pointer",
                currentId === snippet.id
                  ? "bg-accent border-primary/20 shadow-sm"
                  : "hover:bg-accent/50 hover:border-border"
              )}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1 min-w-0">
                  <h3 className={cn(
                    "font-medium text-sm truncate pr-6",
                    currentId === snippet.id ? "text-primary" : "text-foreground"
                  )}>
                    {snippet.title}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-[10px] uppercase bg-background/50 px-1.5 py-0.5 rounded border border-border/50">
                      {snippet.language}
                    </span>
                    <span>•</span>
                    <span>
                      {snippet.createdAt 
                        ? format(new Date(snippet.createdAt), "MMM d") 
                        : "Unknown"}
                    </span>
                  </div>
                </div>

                <div className="absolute right-2 top-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                   <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Are you sure you want to delete this snippet?")) {
                        deleteSnippet(snippet.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                
                {currentId === snippet.id && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-100 group-hover:opacity-0 transition-opacity">
                    <ChevronRight className="w-4 h-4 text-primary" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
