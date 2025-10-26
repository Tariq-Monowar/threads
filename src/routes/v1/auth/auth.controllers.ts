
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

    const user = await prisma.user.findUnique({
      where: {
        id: parseInt(myId),
      },  
    });

    if (!user) {
      return reply.status(404).send({ success: false, message: "User not found" });
    }

    return reply.send({ success: true, data: user });
  } catch (error) {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to get user info" });
  }
};