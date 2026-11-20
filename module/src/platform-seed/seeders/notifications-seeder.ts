import { notifications } from '../../modules/notifications/schema';
import {
  Notification_1,
  Notification_2,
  Notification_3,
  Notification_4,
  Notification_5,
  User_Admin,
  User_Alice,
  User_Bob,
} from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

registerPlatformSeed('notifications', async ({ db, now }) => {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  await db.insert(notifications).values([
    {
      id: Notification_1,
      userId: User_Admin,
      type: 'system',
      title: 'Welcome to OpenCRQ',
      message: 'Your platform has been initialized successfully. Start by configuring your tenants and inviting users.',
      read: true,
      createdAt: hoursAgo(48),
    },
    {
      id: Notification_2,
      userId: User_Admin,
      type: 'security',
      title: 'Security policy update',
      message: 'New compliance requirements have been published. Review the latest NIST framework updates.',
      read: false,
      createdAt: hoursAgo(2),
    },
    {
      id: Notification_3,
      userId: User_Alice,
      type: 'task',
      title: 'Risk assessment due',
      message: 'The quarterly risk assessment for Acme Europe is due in 5 days.',
      read: false,
      createdAt: hoursAgo(6),
    },
    {
      id: Notification_4,
      userId: User_Alice,
      type: 'system',
      title: 'New organization added',
      message: 'Partner Corp has been added to your tenant. Review its security profile.',
      read: true,
      createdAt: hoursAgo(24),
    },
    {
      id: Notification_5,
      userId: User_Bob,
      type: 'audit',
      title: 'Audit report available',
      message: 'The Q4 compliance audit report for Acme Bank is ready for review.',
      read: false,
      createdAt: hoursAgo(12),
    },
  ]);
});
