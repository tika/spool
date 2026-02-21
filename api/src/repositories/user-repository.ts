import { eq } from "drizzle-orm";
import { db, users, type User, type NewUser } from "../db";

export class UserRepository {
  async createUser(username: string): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({ username })
      .returning();
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return user ?? null;
  }
}

export const userRepository = new UserRepository();
