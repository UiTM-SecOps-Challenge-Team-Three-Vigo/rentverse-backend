const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { prisma } = require('../config/database'); // Ensure path is correct
const { verifyAppleToken } = require('apple-signin-auth');

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// ✅ SHARED HELPER: Handles Find/Create logic for ALL providers
const handleSocialAuth = async (provider, profileData, done) => {
  try {
    const { email, name, providerId, profilePicture, firstName, lastName } =
      profileData;

    if (!email) {
      return done(new Error(`No email found from ${provider} profile`), null);
    }

    // 1. Check if user exists linked to this provider (e.g., googleId matches)
    // Note: We use dynamic key access like [provider + 'Id']
    const providerKey = `${provider}Id`; // e.g., 'googleId', 'facebookId'

    let user = await prisma.user.findFirst({
      where: { [providerKey]: providerId },
    });

    if (user) {
      // User exists and is linked. Update profile picture if missing.
      if (!user.profilePicture && profilePicture) {
        await prisma.user.update({
          where: { id: user.id },
          data: { profilePicture },
        });
      }
      return done(null, user);
    }

    // 2. Check if user exists by EMAIL (Link Account)
    user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      // User exists but not linked. Link the account now.
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          [providerKey]: providerId,
          profilePicture: user.profilePicture || profilePicture, // Update pic if empty
        },
      });
      return done(null, user);
    }

    // 3. Create NEW User
    const randomPassword = await bcrypt.hash(
      Math.random().toString(36).substring(2, 15),
      12
    );

    // Handle Name Splitting if not provided
    const fName = firstName || name.split(' ')[0] || 'User';
    const lName = lastName || name.split(' ').slice(1).join(' ') || '';

    user = await prisma.user.create({
      data: {
        email,
        name,
        firstName: fName,
        lastName: lName,
        password: randomPassword,
        [providerKey]: providerId,
        profilePicture,
        role: 'USER',
        isActive: true,
        verifiedAt: new Date(),
      },
    });

    // 🚩 FLAG NEW USER
    // This property is attached to the user object in memory only.
    // The controller will read this and redirect to "Complete Profile".
    user.isNew = true;

    return done(null, user);
  } catch (error) {
    console.error(`${provider} Auth Error:`, error);
    return done(error, null);
  }
};

// --- STRATEGIES ---

// 1. Google
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/google/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      const data = {
        providerId: profile.id,
        email: profile.emails[0]?.value,
        name: profile.displayName,
        profilePicture: profile.photos[0]?.value,
      };
      handleSocialAuth('google', data, done);
    }
  )
);

// 2. Facebook
passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/facebook/callback`,
      profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
    },
    (accessToken, refreshToken, profile, done) => {
      const data = {
        providerId: profile.id,
        email: profile.emails[0]?.value,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        name: `${profile.name.givenName} ${profile.name.familyName}`,
        profilePicture: profile.photos[0]?.value,
      };
      handleSocialAuth('facebook', data, done);
    }
  )
);

// 3. GitHub
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/github/callback`,
      scope: ['user:email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      let email = profile.emails?.[0]?.value;

      // Fetch email manually if private
      if (!email) {
        try {
          const res = await axios.get('https://api.github.com/user/emails', {
            headers: {
              Authorization: `token ${accessToken}`,
              'User-Agent': 'Rentverse',
            },
          });
          const primary = res.data.find(e => e.primary && e.verified);
          email = primary ? primary.email : res.data[0].email;
        } catch (e) {
          console.error('Failed to fetch GitHub email');
        }
      }

      const data = {
        providerId: profile.id,
        email: email || `${profile.username}@github.placeholder.com`,
        name: profile.displayName || profile.username,
        profilePicture: profile.photos?.[0]?.value,
      };
      handleSocialAuth('github', data, done);
    }
  )
);

// 4. Twitter
passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/twitter/callback`,
      includeEmail: true,
    },
    (token, tokenSecret, profile, done) => {
      const data = {
        providerId: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName || profile.username,
        profilePicture: profile.photos?.[0]?.value,
      };
      handleSocialAuth('twitter', data, done);
    }
  )
);

// 5. Apple (Manual Handler)
const handleAppleSignIn = async (appleToken, userInfo = null) => {
  try {
    const applePayload = await verifyAppleToken(appleToken, {
      audience: process.env.APPLE_CLIENT_ID,
      issuer: 'https://appleid.apple.com',
    });

    if (!applePayload) throw new Error('Invalid Apple token');

    const email = applePayload.email;
    const appleId = applePayload.sub;

    // Construct data for helper
    const data = {
      providerId: appleId,
      email: email,
      name:
        userInfo && userInfo.name
          ? `${userInfo.name.firstName} ${userInfo.name.lastName}`.trim()
          : 'Apple User',
      firstName: userInfo?.name?.firstName,
      lastName: userInfo?.name?.lastName,
    };

    // We can't use the standard `done` callback pattern here since this is called directly by a controller
    // So we manually invoke the logic, but modified slightly for direct return

    // 1. Check existing
    let user = await prisma.user.findUnique({ where: { appleId } });
    if (user) return user;

    // 2. Link account
    user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      return await prisma.user.update({
        where: { id: user.id },
        data: { appleId },
      });
    }

    // 3. Create New
    const randomPassword = await bcrypt.hash(Math.random().toString(36), 12);
    user = await prisma.user.create({
      data: {
        email,
        name: data.name,
        firstName: data.firstName || 'Apple',
        lastName: data.lastName || 'User',
        password: randomPassword,
        appleId,
        role: 'USER',
        isActive: true,
        verifiedAt: new Date(),
      },
    });

    user.isNew = true; // 🚩 Flag for controller
    return user;
  } catch (error) {
    console.error('Apple Sign In error:', error);
    throw error;
  }
};

module.exports = { passport, handleAppleSignIn };
