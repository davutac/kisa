import { TriangleAlertIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PermanentDeleteDialogProps {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const PermanentDeleteDialog = ({
  onConfirm,
  onOpenChange,
  open,
}: PermanentDeleteDialogProps) => (
  <AlertDialog onOpenChange={onOpenChange} open={open}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <TriangleAlertIcon aria-hidden="true" />
        </AlertDialogMedia>
        <AlertDialogTitle>Delete this conversation forever?</AlertDialogTitle>
        <AlertDialogDescription>
          This permanently deletes the conversation from Gmail. This action
          cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          type="button"
          variant="destructive"
        >
          Delete forever
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default PermanentDeleteDialog;
