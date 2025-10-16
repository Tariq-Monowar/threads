"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = void 0;
// {
//             "ID": "2",
//             "Name": "Md Sohrab Hossain",
//             "mobile": "123",
//             "User": "mdsohrabhossainjoy11@gmail.com",
//             "Address": "",
//             "Image": "sys/stores/175251547034.jpg"
//         }
const registerUser = async (request, reply) => {
    try {
        const { id, name, email, avatar, Image, address } = request.body;
        const missingField = ["name", "id"].find((field) => !request.body[field]);
        if (missingField) {
            return reply.status(400).send({
                success: false,
                message: `${missingField} is required!`,
            });
        }
        const prisma = request.server.prisma;
        const redis = request.server.redis;
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            return reply.status(400).send({
                success: false,
                message: "User with this email already exists",
            });
        }
        const newUser = await prisma.user.create({
            data: {
                id,
                name,
                email,
                avatar,
                Image,
                address,
            },
        });
        return reply.status(200).send({
            success: true,
            message: "user created success!",
            user: newUser,
        });
    }
    catch (error) {
        request.log.error(error);
        return reply.status(500).send({
            succes: false,
            error: error,
            message: "Internal function Error!",
        });
    }
};
exports.registerUser = registerUser;
//# sourceMappingURL=auth.controllers.js.map