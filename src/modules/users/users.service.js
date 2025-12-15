const usersRepository = require('./users.repository');
const { prisma } = require('../../config/database');

class UsersService {
  async getAllUsers(page = 1, limit = 10, role = null) {
    const skip = (page - 1) * limit;
    const where = {};

    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      usersRepository.findMany({ where, skip, take: limit }),
      usersRepository.count(where),
    ]);

    const pages = Math.ceil(total / limit);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages,
      },
    };
  }

  async getUserById(id) {
    const user = await usersRepository.findById(id);

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }

  async updateUser(id, updateData, requestingUser) {
    // Check if user exists
    const existingUser = await usersRepository.findById(id);
    if (!existingUser) {
      throw new Error('User not found');
    }

    // Authorization check
    if (requestingUser.role !== 'ADMIN' && requestingUser.id !== id) {
      throw new Error('Access denied. You can only update your own profile.');
    }

    // Only admins can change role and isActive
    if (
      (updateData.role || updateData.isActive !== undefined) &&
      requestingUser.role !== 'ADMIN'
    ) {
      throw new Error(
        'Access denied. Only admins can change role or active status.'
      );
    }

    // Prepare update data
    const cleanUpdateData = {};
    if (updateData.firstName !== undefined)
      cleanUpdateData.firstName = updateData.firstName;
    if (updateData.lastName !== undefined)
      cleanUpdateData.lastName = updateData.lastName;
    if (updateData.dateOfBirth !== undefined)
      cleanUpdateData.dateOfBirth = updateData.dateOfBirth;
    if (updateData.phone !== undefined)
      cleanUpdateData.phone = updateData.phone;
    if (updateData.profilePicture !== undefined)
      cleanUpdateData.profilePicture = updateData.profilePicture;
    if (updateData.role && requestingUser.role === 'ADMIN')
      cleanUpdateData.role = updateData.role;
    if (updateData.isActive !== undefined && requestingUser.role === 'ADMIN') {
      cleanUpdateData.isActive = updateData.isActive;
    }

    return await usersRepository.update(id, cleanUpdateData);
  }

  async deleteUser(id, requestingUser) {
    // Check if user exists
    const existingUser = await usersRepository.findById(id);
    if (!existingUser) {
      throw new Error('User not found');
    }

    // Prevent admin from deleting themselves
    if (requestingUser.id === id) {
      throw new Error('You cannot delete your own account');
    }

    await usersRepository.delete(id);
    return { message: 'User deleted successfully' };
  }

  async createUser(userData) {
    const bcryptjs = require('bcryptjs');

    // Check if user already exists
    const existingUser = await usersRepository.findByEmail(userData.email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcryptjs.hash(userData.password, saltRounds);

    // Create user with new schema fields
    const newUser = await usersRepository.create({
      email: userData.email,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      dateOfBirth: userData.dateOfBirth ? new Date(userData.dateOfBirth) : null,
      phone: userData.phone,
      password: hashedPassword,
      role: userData.role || 'USER',
      isActive: userData.isActive !== undefined ? userData.isActive : true,
    });

    return newUser;
  }

  async checkUserAccess(userId, requestingUser) {
    // Users can only view their own profile, admins can view any profile
    if (requestingUser.role !== 'ADMIN' && requestingUser.id !== userId) {
      throw new Error('Access denied. You can only view your own profile.');
    }
    return true;
  }
  /**
   * Get security activity logs for a user
   */
  async getUserActivityLogs(userId) {
    return await prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10, // Fetch last 10 events
      select: {
        id: true,
        action: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        details: true, // Optional: if you want to show failure reasons
      },
    });
  }
}

module.exports = new UsersService();
