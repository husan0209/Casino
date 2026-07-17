export interface UserProfileProps {
  userId: string
  firstName: string | null
  lastName: string | null
  dateOfBirth: Date | null
  country: string | null
  city: string | null
  phone: string | null
  avatarUrl: string | null
}
export class UserProfileEntity {
  constructor(public props: UserProfileProps) {}
  get userId() { return this.props.userId }
}
