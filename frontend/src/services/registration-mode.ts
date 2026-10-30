import { registrationService } from './registration.service';
import type { createRegistrationDemo } from '../demo/registration-demo';

// DEV is replaced with false by Vite in production builds, regardless of the flag.
export const registrationDemoEnabled = import.meta.env.DEV && import.meta.env.VITE_TV2_DEMO === 'true';
type DemoService = ReturnType<typeof createRegistrationDemo>;
type Client = typeof registrationService & Partial<Pick<DemoService, 'resetDemo' | 'closeDemo'>>;
const sessions = new Map<string, Promise<DemoService>>();
export function getRegistrationService(userId?: string): Client {
  if (!registrationDemoEnabled) return registrationService;
  const demo = () => {
    if (!userId) throw new Error('Vui lòng đăng nhập để sử dụng DEMO.');
    let session = sessions.get(userId);
    if (!session) {
      session = import('../demo/registration-demo').then(module => module.createRegistrationDemo(userId));
      sessions.set(userId, session);
    }
    return session;
  };
  return {
    load: async () => (await demo()).load(),
    save: async (period, preferences, mode) => (await demo()).save(period, preferences, mode),
    resetDemo: async () => (await demo()).resetDemo(),
    closeDemo: async () => (await demo()).closeDemo(),
  };
}
