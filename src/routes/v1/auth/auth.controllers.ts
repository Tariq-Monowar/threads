export const registerUser = async (request, reply) => {
  try {
    const { id, name, email, avatar, address } = request.body;

    const missingField = ["id", "name"].find((field) => !request.body[field]);

    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    const prisma = request.server.prisma;

    const existingUserById = await prisma.user.findUnique({
      where: { id },
    });

    if (existingUserById) {
      return reply.status(400).send({
        success: false,
        message: "User with this ID already exists",
      });
    }

    const newUser = await prisma.user.create({
      data: {
        id,
        name,
        email,
        avatar,
        address,
      },
    });

    return reply.status(200).send({
      success: true,
      message: "User created successfully!",
      data: newUser,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Registration failed. Please try again.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const updateUser = async (request, reply) => {
  try {
    const updateData = request.body;
    const { id } = request.params;

    if (!id) {
      return reply.status(400).send({
        success: false,
        message: "User ID is required",
      });
    }

    const prisma = request.server.prisma;
    const userId = parseInt(id);

    // Check if user exists first
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return reply.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    const filteredUpdateData = Object.fromEntries(
      Object.entries(updateData).filter(
        ([key, value]) => value !== undefined && value !== "" && value !== null
      )
    );

    if (Object.keys(filteredUpdateData).length === 0) {
      return reply.status(400).send({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: filteredUpdateData,
    });

    return reply.status(200).send({
      success: true,
      message: "User update successfully!",
      data: updatedUser,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Update failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getAllUsers = async (request, reply) => {
  try {
    const prisma = request.server.prisma;

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });

    return reply.status(200).send({
      success: true,
      message: "Users retrieved successfully",
      data: users,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to fetch users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const deleteUser = async (request, reply) => {
  try {
    const { id } = request.params as { id: string };

    if (!id) {
      return reply.status(400).send({
        success: false,
        message: "User ID is required",
      });
    }

    const prisma = request.server.prisma;
    const userId = parseInt(id);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return reply.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    return reply.status(200).send({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to delete user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const myinfo = async (request, reply) => {
  try {
    const { myId } = request.params;
    const prisma = request.server.prisma;

    // Convert string to number
    const id = Number(myId);

    // Validate that it's a real number
    if (isNaN(id)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user ID — must be a number",
      });
    }

    // Query Prisma with an Int (not String)
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return reply.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    return reply.send({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error in myinfo:", error);
    return reply.status(500).send({
      success: false,
      error: error.message,
      message: "Failed to get user info",
    });
  }
};

export const searchUsers = async (request, reply) => {
  try {
    const { myId } = request.params;
    console.log("myId", myId);
    const { search, page = 1, limit = 20 } = request.query;

    console.log("search", search);
    console.log("page", page);
    console.log("limit", limit);

    const currentUserId = Number(myId);
    if (isNaN(currentUserId)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user ID — must be a number",
      });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const prisma = request.server.prisma;

    let whereCondition: any = {
      id: { not: currentUserId },
    };

    if (search && search.trim() !== "") {
      whereCondition.OR = [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereCondition,
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          address: true,
          createdAt: true,
        },
        orderBy: [{ name: "asc" }, { createdAt: "desc" }],
        skip,
        take: limitNum,
      }),
      prisma.user.count({
        where: whereCondition,
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    if (!search) {
      return reply.status(200).send({
        success: true,
        message: "Users retrieved successfully",
        data: [],
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          hasNextPage,
          hasPrevPage,
          limit: limitNum,
        },
      });
    }

    return reply.status(200).send({
      success: true,
      message: "Users retrieved successfully",
      data: users,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage,
        hasPrevPage,
        limit: limitNum,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Search failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
