export const getImageUrl = (imagePath: string) => {
    return `${process.env.BASE_URL}/uploads/${imagePath}`;
  };
  
  export const baseUrl = process.env.BASE_URL;
  