import { getImageUrl } from "./baseurl";
import { FileService } from "./fileService";


export function transformMessage(
  message: any,
  participantIds: number[]
): any {
  const clone = { ...message } as any;
  if ("deletedForUsers" in clone) {
    delete clone.deletedForUsers;
  }

  const senderId = typeof clone.userId === "number" ? clone.userId : null;
  const receiverId = participantIds.filter((id) => id !== senderId);

  return {
    ...clone,
    senderId,
    receiverId,
    user: clone.user
      ? {
          ...clone.user,
          avatar: clone.user.avatar
            ? FileService.avatarUrl(clone.user.avatar)
            : null,
        }
      : clone.user,
    MessageFile: (clone.MessageFile || []).map((f: any) => ({
      ...f,
      fileUrl: f?.fileUrl ? getImageUrl(f.fileUrl) : f.fileUrl,
    })),
  };
}

