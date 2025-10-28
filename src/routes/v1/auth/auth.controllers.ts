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



export const syncUsers = async (request, reply) => {
  try {
    const prisma = request.server.prisma;

    // 1️⃣ Prepare form data
    const formData = new URLSearchParams();
    formData.append("admin_user", "aminbd");

    // 2️⃣ Make POST request to external API
    const response = await fetch(
      "https://deficall.defilinkteam.org/api/profile_list.php",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }
    );

    // 3️⃣ Check if response is OK
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 4️⃣ Parse JSON response
    const res = await response.json();
    
    // 5️⃣ Log the full response for debugging
    request.log.info("Full API response:", JSON.stringify(res, null, 2));

    // 6️⃣ Validate response with more detailed checks
    if (!res) {
      request.log.error("Empty API response");
      return reply.status(500).send({
        success: false,
        message: "External API returned empty response",
      });
    }

    if (res.success === false) {
      request.log.error("API returned success: false", res);
      return reply.status(500).send({
        success: false,
        message: "External API returned error",
        apiError: res.message || res.error || "Unknown API error"
      });
    }

    // Check multiple possible response structures
    let externalUsers = null;
    
    if (Array.isArray(res.data?.report)) {
      externalUsers = res.data.report;
    } else if (Array.isArray(res.report)) {
      externalUsers = res.report;
    } else if (Array.isArray(res.data)) {
      externalUsers = res.data;
    } else if (Array.isArray(res)) {
      externalUsers = res;
    } else if (res.data && typeof res.data === 'object') {
      // If data is an object, try to convert it to array
      externalUsers = Object.values(res.data);
    }

    if (!externalUsers || !Array.isArray(externalUsers)) {
      request.log.error("Invalid users data structure:", {
        data: res.data,
        report: res.report,
        fullResponse: res
      });
      return reply.status(500).send({
        success: false,
        message: "External API returned invalid user data structure",
        responseStructure: Object.keys(res)
      });
    }

    if (externalUsers.length === 0) {
      request.log.warn("External API returned empty users array");
      return reply.send({
        success: true,
        message: "Sync completed - no users found in external API",
        data: []
      });
    }

    // 7️⃣ Delete all existing users
    await prisma.user.deleteMany({});
    request.log.info("Deleted all existing users");

    // 8️⃣ Map API fields to Prisma User model with validation
    const usersToInsert = externalUsers
      .map((user, index) => {
        try {
          // Validate required fields
          if (!user.ID && !user.id) {
            request.log.warn(`User at index ${index} missing ID:`, user);
            return null;
          }

          return {
            id: parseInt(user.ID || user.id || user.user_id || index),
            name: user.Name || user.name || user.username || "",
            email: user.User || user.user || user.email || user.Email || "",
            avatar: user.Image || user.image || user.avatar || user.profile_picture || "",
            address: user.Address || user.address || user.wallet_address || "",
          };
        } catch (error) {
          request.log.warn(`Failed to process user at index ${index}:`, user, error);
          return null;
        }
      })
      .filter(user => user !== null); // Remove null entries

    if (usersToInsert.length === 0) {
      request.log.error("No valid users to insert after processing");
      return reply.status(500).send({
        success: false,
        message: "No valid users found to insert",
      });
    }

    // 9️⃣ Insert new users
    await prisma.user.createMany({
      data: usersToInsert,
      skipDuplicates: true,
    });
    request.log.info(`Inserted ${usersToInsert.length} users from external API`);

    // 🔟 Return success
    return reply.send({
      success: true,
      message: `Users synced successfully! Total inserted: ${usersToInsert.length}`,
      data: usersToInsert,
    });
  } catch (error) {
    request.log.error("Sync failed with error:", error);
    return reply.status(500).send({
      success: false,
      message: "Sync failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};