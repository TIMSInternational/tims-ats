import { notificationRepository } from '../repositories/notification.repository';

export { InvalidNotificationRecipientsError } from '../repositories/notification.repository';

export const notificationService = {
  create(...args: Parameters<typeof notificationRepository.create>) {
    return notificationRepository.create(...args);
  },
  bulkCreate(...args: Parameters<typeof notificationRepository.bulkCreate>) {
    return notificationRepository.bulkCreate(...args);
  },
};
