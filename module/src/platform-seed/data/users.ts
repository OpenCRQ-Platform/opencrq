import {
  User_Admin,
  User_Alice,
  User_Bob,
  User_Charlie,
  User_Eve,
} from './ids';

interface SeedUser {
  id: string,
  email: string,
  name: string,
  title: string,
  locale: string,
  theme?: string,
}

export const seedUsers: Array<SeedUser> = [
  {
    id: User_Alice,
    email: 'alice@example.com',
    name: 'Alice Martin',
    title: 'Security Analyst',
    locale: 'en',
    theme: 'system',
  },
  {
    id: User_Bob,
    email: 'bob@example.com',
    name: 'Bob Johnson',
    title: 'Auditor',
    locale: 'en',
    theme: 'system',
  },
  {
    id: User_Charlie,
    email: 'charlie@example.com',
    name: 'Charlie Dupont',
    title: 'Viewer',
    locale: 'fr',
    theme: 'system',
  },
  {
    id: User_Eve,
    email: 'eve@example.com',
    name: 'Eve Williams',
    title: 'Tenant Admin',
    locale: 'en',
    theme: 'system',
  },
];

export const adminUser = {
  id: User_Admin,
  name: 'Platform Admin',
  title: 'Platform Administrator',
  locale: 'en',
  theme: 'system',
};
