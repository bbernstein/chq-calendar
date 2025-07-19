import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

const handler = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  ],
  callbacks: {
    async signIn({ user }) {
      // Allow only specific email addresses for admin access
      const allowedEmails = process.env.ADMIN_EMAIL_WHITELIST?.split(',') || [];
      
      if (allowedEmails.length === 0) {
        console.warn('No ADMIN_EMAIL_WHITELIST configured - allowing all Google users');
        return true;
      }
      
      if (user.email && allowedEmails.includes(user.email)) {
        return true;
      }
      
      console.log(`Access denied for email: ${user.email}`);
      return false;
    },
    async session({ session }) {
      return session;
    },
    async jwt({ token }) {
      return token;
    },
  },
  pages: {
    signIn: '/admin/login',
    error: '/admin/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
})

export { handler as GET, handler as POST }