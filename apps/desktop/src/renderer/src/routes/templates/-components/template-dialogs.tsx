import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TemplateDialogsProps {
  readonly deleteOpen: boolean;
  readonly deleteTemplateName?: string;
  readonly discardOpen: boolean;
  readonly onCancelDiscard: () => void;
  readonly onConfirmDelete: () => Promise<void>;
  readonly onConfirmDiscard: () => void;
  readonly onDeleteOpenChange: (open: boolean) => void;
}

const TemplateDialogs = ({
  deleteOpen,
  deleteTemplateName,
  discardOpen,
  onCancelDiscard,
  onConfirmDelete,
  onConfirmDiscard,
  onDeleteOpenChange,
}: TemplateDialogsProps) => (
  <>
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onCancelDiscard();
        }
      }}
      open={discardOpen}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes to this template have not been saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelDiscard}>
            Keep editing
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmDiscard} variant="destructive">
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog onOpenChange={onDeleteOpenChange} open={deleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleteTemplateName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This template will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmDelete} variant="destructive">
            Delete template
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
);

export default TemplateDialogs;
