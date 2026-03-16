import React, { useState, useEffect } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import { Play, Save, CheckCircle2, RotateCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button-custom";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCreateSnippet, useSnippet } from "@/hooks/use-snippets";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CodeEditorProps {
  selectedId: number | null;
}

export function CodeEditor({ selectedId }: CodeEditorProps) {
  const [code, setCode] = useState(`# Write your Python code here\nprint("Hello, World!")`);
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [title, setTitle] = useState("Untitled Snippet");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const { toast } = useToast();
  const { mutate: createSnippet, isPending: isSaving } = useCreateSnippet();
  const { data: selectedSnippet, isLoading: isLoadingSnippet } = useSnippet(selectedId);

  // Update editor when selection changes
  useEffect(() => {
    if (selectedSnippet) {
      setCode(selectedSnippet.code);
      setTitle(selectedSnippet.title);
      setOutput(selectedSnippet.output || "");
    } else if (selectedId === null) {
      setCode(`# Write your Python code here\nprint("Hello, World!")`);
      setTitle("Untitled Snippet");
      setOutput("");
    }
  }, [selectedSnippet, selectedId]);

  const handleRun = async () => {
    setIsRunning(true);
    setOutput("");
    
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      
      const data = await response.json();
      setOutput(data.output || '>>> Execution finished (No output)');
      
      if (response.ok) {
        toast({
          title: "Execution Complete",
          description: "Code ran successfully.",
          className: "bg-green-900/50 border-green-800 text-green-100",
        });
      }
    } catch (err) {
      setOutput(`Error: Failed to execute code. ${err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSave = () => {
    createSnippet({
      title,
      code,
      language: "python",
      output,
    }, {
      onSuccess: () => {
        setIsDialogOpen(false);
        toast({
          title: "Snippet Saved",
          description: `"${title}" has been saved to your library.`,
        });
      }
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary">
            <span className="font-mono font-bold text-xs">PY</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">{title}</h1>
            <p className="text-xs text-muted-foreground">Python 3.10</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="gap-2 h-9">
                <Save className="w-4 h-4" />
                {selectedId ? "Save Copy" : "Save Snippet"}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle>Save Snippet</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Snippet Title</Label>
                  <Input 
                    id="title" 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Fibonacci Sequence"
                    className="bg-background border-input"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  onClick={handleSave} 
                  disabled={isSaving}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isSaving ? "Saving..." : "Save to Library"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button 
            variant="run" 
            onClick={handleRun}
            disabled={isRunning}
            className="gap-2 h-9 px-6 transition-all duration-300"
          >
            {isRunning ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            Run Code
          </Button>
        </div>
      </div>

      {/* Main Split Content */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Code Input Pane */}
        <div className="flex-1 min-h-[50%] md:min-h-0 flex flex-col bg-[#0d1117] relative">
          <div className="absolute top-0 right-0 p-2 z-10 pointer-events-none">
            <span className="text-[10px] text-muted-foreground/40 font-mono uppercase tracking-widest">Input</span>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar font-mono text-sm relative">
            <div className="min-h-full">
              <Editor
                value={code}
                onValueChange={code => setCode(code)}
                highlight={code => Prism.highlight(code, Prism.languages.python, 'python')}
                padding={24}
                className="font-mono min-h-full"
                textareaClassName="focus:outline-none"
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 14,
                  backgroundColor: 'transparent',
                  minHeight: '100%',
                }}
              />
            </div>
          </div>
        </div>

        {/* Output Pane */}
        <div className="flex-1 min-h-[40%] md:min-h-0 flex flex-col bg-[#0d1117]/50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              Console Output
            </span>
            {output && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setOutput("")}
              >
                Clear
              </Button>
            )}
          </div>
          
          <div className="flex-1 p-6 overflow-auto font-mono text-sm">
            {isRunning ? (
              <div className="flex items-center gap-2 text-yellow-500 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                Executing script...
              </div>
            ) : output ? (
              <pre className="whitespace-pre-wrap break-words text-green-400 font-mono text-sm leading-relaxed">
                {output}
              </pre>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/30">
                <Play className="w-12 h-12 mb-4 opacity-20" />
                <p>Run code to see output</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
