import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from './ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Import brut du fichier Markdown (exemple Vite)
import helpDocumentation from '@/doc/help.md?raw';

interface HelpPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpPanel({ open, onOpenChange }: HelpPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-3/4! max-w-none! sm:w-3/4! sm:max-w-none!"
      >
        <SheetHeader>
          <SheetTitle>Help Center</SheetTitle>
          <SheetDescription>
            Find answers to common questions or read the quick start guides.
          </SheetDescription>
        </SheetHeader>

        {/* Zone de contenu défilable avec stylisation automatique `prose` */}
        <div className="flex-1 overflow-y-auto py-4 pr-2">
          <div className="prose prose-slate dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {helpDocumentation}
            </ReactMarkdown>
          </div>
        </div>

         <SheetFooter>
            <SheetClose render={<Button variant="outline">Close</Button>} />
        </SheetFooter>       
      </SheetContent>
    </Sheet>
  );
}