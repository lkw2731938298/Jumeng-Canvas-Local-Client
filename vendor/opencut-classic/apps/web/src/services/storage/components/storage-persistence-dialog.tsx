"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useStoragePersistence } from "@/services/storage/use-storage-persistence";

export function StoragePersistenceDialog() {
	const { showDialog, onConfirm, onDismiss } = useStoragePersistence();

	return (
		<Dialog open={showDialog} onOpenChange={(open) => !open && onDismiss()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>避免工程丢失</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<p className="text-base text-muted-foreground">
						浏览器在存储空间不足时可能会自动清理本地工程。
					</p>
					<p className="text-base text-muted-foreground">
						是否允许剪辑台持久化存储以保护工程？
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onDismiss}>
						暂不
					</Button>
					<Button onClick={onConfirm}>允许</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
