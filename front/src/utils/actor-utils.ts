export interface ServiceAccountActorRef {
  id: string,
  name: string | null,
}

export type Actor =
  | { kind: 'user', label: string }
  | { kind: 'serviceAccount', id: string, name: string | null };

const isBlank = (value: string | null): value is null => value === null || value.trim() === '';

/** Who did something: the person when there is one, else the service account, else nobody. */
export const resolveActor = (userLabel: string | null, serviceAccount: ServiceAccountActorRef | null): Actor | null => {
  if (!isBlank(userLabel)) {
    return { kind: 'user', label: userLabel };
  }
  if (serviceAccount !== null) {
    return { kind: 'serviceAccount', id: serviceAccount.id, name: isBlank(serviceAccount.name) ? null : serviceAccount.name };
  }
  return null;
};
