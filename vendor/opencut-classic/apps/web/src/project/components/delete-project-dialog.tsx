import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function DeleteProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectNames,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	projectNames: string[];
}) {
	const count = projectNames.length;
	const isSingle = count === 1;
	const singleName = isSingle ? projectNames[0] : null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{singleName ? (
							<>
								{"删除「"}
								<span className="inline-block max-w-[300px] truncate align-bottom">
									{singleName}
								</span>
								{"」？"}
							</>
						) : (
							`删除 ${count} 个工程？`
						)}
					</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<Alert variant="destructive">
						<AlertTitle>警告</AlertTitle>
						<AlertDescription>
							{singleName ? `将永久删除「${singleName}」及其关联文件。` : `将永久删除 ${count} 个工程及其关联文件。`}
						</AlertDescription>
					</Alert>
					<div className="flex flex-col gap-3">
						<Label className="text-xs font-semibold text-slate-500">
							输入 DELETE 以确认
						</Label>
						<Input
							type="text"
							placeholder="DELETE"
							size="lg"
							variant="destructive"
						/>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button variant="destructive" onClick={onConfirm}>
						删除工程
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
