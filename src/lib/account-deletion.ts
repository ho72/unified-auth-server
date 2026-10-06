import { unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

export const ACCOUNT_DELETION_GRACE_DAYS = 30
export const ACCOUNT_DELETION_GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000

const AVATAR_PUBLIC_PREFIX = '/uploads/avatars/'
const AVATAR_UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'uploads', 'avatars')
const LOCAL_AVATAR_NAME_RE = /^[a-f0-9]{48}\.(jpg|png|webp|gif)$/

export function deletionScheduledAt(now = new Date()) {
  return new Date(now.getTime() + ACCOUNT_DELETION_GRACE_MS)
}

export async function purgeExpiredDeletedUsers(prisma: any, now = new Date()) {
  const users = await prisma.user.findMany({
    where: {
      deletionScheduledAt: {
        lte: now,
      },
    },
    select: {
      id: true,
      avatarUrl: true,
    },
  })
  if (!users.length) return 0

  await prisma.user.deleteMany({
    where: {
      id: {
        in: users.map((user: { id: string }) => user.id),
      },
    },
  })

  await Promise.all(users.map((user: { avatarUrl?: string | null }) => deleteLocalAvatar(user.avatarUrl)))
  return users.length
}

export async function cancelAccountDeletionIfPending(prisma: any, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletionScheduledAt: true },
  })
  if (!user?.deletionScheduledAt) return false

  await prisma.user.update({
    where: { id: userId },
    data: {
      deletionRequestedAt: null,
      deletionScheduledAt: null,
    },
  })
  return true
}

async function deleteLocalAvatar(previousUrl?: string | null) {
  if (!previousUrl?.startsWith(AVATAR_PUBLIC_PREFIX)) return

  const filename = basename(previousUrl.slice(AVATAR_PUBLIC_PREFIX.length))
  if (!LOCAL_AVATAR_NAME_RE.test(filename)) return

  await unlink(join(AVATAR_UPLOAD_DIR, filename)).catch(() => {})
}
