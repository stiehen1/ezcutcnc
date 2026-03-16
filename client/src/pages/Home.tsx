import React, { useState } from "react";
import { SnippetList } from "@/components/SnippetList";
import { CodeEditor } from "@/components/CodeEditor";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button-custom";
import { Menu } from "lucide-react";

export default function Home() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setIsMobileMenuOpen(false);
  };

  const handleNew = () => {
    setSelectedId(null);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="h-screen w-screen bg-background overflow-hidden flex flex-col">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center p-4 border-b border-border bg-card">
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-2">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-80 border-r border-border bg-card">
            <SnippetList 
              currentId={selectedId} 
              onSelect={handleSelect} 
              onNew={handleNew} 
            />
          </SheetContent>
        </Sheet>
        <span className="font-semibold">PyCode Runner</span>
      </div>

      {/* Desktop Layout */}
      <div className="flex-1 h-full overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Sidebar - hidden on mobile */}
          <ResizablePanel 
            defaultSize={20} 
            minSize={15} 
            maxSize={30} 
            className="hidden md:block bg-card border-r border-border"
          >
            <SnippetList 
              currentId={selectedId} 
              onSelect={handleSelect} 
              onNew={handleNew} 
            />
          </ResizablePanel>
          
          <ResizableHandle className="hidden md:flex bg-border w-[1px]" />
          
          <ResizablePanel defaultSize={80}>
            <CodeEditor selectedId={selectedId} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
